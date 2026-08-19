import { Archive, CircleAlert, Cpu, Database, HardDriveDownload, ListChecks, Radio, Users } from "lucide-react";
import { desc, eq, sql } from "drizzle-orm";
import { backups, getDb, incidents, jobs, organizations, repositories, runners, usageRecords, users } from "@northstar/db";
import { usagePeriod } from "@northstar/core";
import { runBackupSweepAction } from "@/app/actions";
import { requireAdmin } from "@/lib/auth";

export const metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

export default async function OpsPage() {
  await requireAdmin();
  const period = usagePeriod();
  const [counts, jobRows, backupRows, incidentRows, runnerRows, tokenUsage] = await Promise.all([
    getDb().select({
      users: sql<string>`(select count(*) from ${users})`,
      organizations: sql<string>`(select count(*) from ${organizations})`,
      repositories: sql<string>`(select count(*) from ${repositories})`,
    }).from(sql`(select 1) as one`),
    getDb().select().from(jobs).orderBy(desc(jobs.createdAt)).limit(25),
    getDb().select({ backup: backups, storageKey: repositories.storageKey }).from(backups).innerJoin(repositories, eq(repositories.id, backups.repositoryId)).orderBy(desc(backups.createdAt)).limit(25),
    getDb().select({ incident: incidents, storageKey: repositories.storageKey }).from(incidents).innerJoin(repositories, eq(repositories.id, incidents.repositoryId)).where(eq(incidents.status, "open")).orderBy(desc(incidents.createdAt)).limit(25),
    getDb().select().from(runners).orderBy(desc(runners.createdAt)).limit(25),
    getDb().select({ total: sql<string>`coalesce(sum(${usageRecords.amount}), 0)` }).from(usageRecords).where(eq(usageRecords.period, period)),
  ]);
  const stats = counts[0]!;
  const failedJobs = jobRows.filter((job) => job.status === "failed");
  return <main className="ops-page shell">
    <div className="section-heading">
      <div><h1>Operations console</h1><p>Queue health, storage replication, incidents, and abuse controls for this Northstar installation.</p></div>
      <form action={runBackupSweepAction}><button className="button button-primary"><HardDriveDownload size={15} /> Run backup sweep</button></form>
    </div>
    <section className="ops-stats">
      <div className="panel"><Users size={16} /><b>{stats.users}</b><span>people</span></div>
      <div className="panel"><Database size={16} /><b>{stats.organizations}</b><span>workspaces</span></div>
      <div className="panel"><Archive size={16} /><b>{stats.repositories}</b><span>repositories</span></div>
      <div className="panel"><Cpu size={16} /><b>{Number(tokenUsage[0]?.total ?? 0).toLocaleString()}</b><span>model tokens · {period}</span></div>
      <div className="panel"><CircleAlert size={16} /><b>{incidentRows.length}</b><span>open incidents</span></div>
    </section>
    <div className="ops-grid">
      <section className="panel ops-table">
        <header><ListChecks size={15} /> <h2>Job queue</h2><span>{failedJobs.length} failed</span></header>
        {jobRows.length ? jobRows.map((job) => <div key={job.id} className={`ops-row ${job.status}`}>
          <b>{job.type}</b>
          <span>{job.status}{job.attempts > 1 ? ` · attempt ${job.attempts}` : ""}</span>
          <small>{job.createdAt.toLocaleString()}</small>
          {job.error && <p>{job.error.slice(0, 200)}</p>}
        </div>) : <p className="ops-empty">The queue is empty.</p>}
      </section>
      <section className="panel ops-table">
        <header><HardDriveDownload size={15} /> <h2>Backups &amp; restore tests</h2><span>{backupRows.filter((row) => row.backup.status === "restore_tested").length} verified</span></header>
        {backupRows.length ? backupRows.map(({ backup, storageKey }) => <div key={backup.id} className={`ops-row ${backup.status === "failed" ? "failed" : "completed"}`}>
          <b>{storageKey}</b>
          <span>{backup.status === "restore_tested" ? "restore verified" : backup.status}{backup.sizeBytes ? ` · ${(backup.sizeBytes / 1024).toFixed(0)} KB` : ""}</span>
          <small>{backup.createdAt.toLocaleString()}</small>
          {backup.error && <p>{backup.error.slice(0, 200)}</p>}
        </div>) : <p className="ops-empty">No backups yet. Run a sweep to bundle, checksum, and restore-test every repository.</p>}
      </section>
      <section className="panel ops-table">
        <header><CircleAlert size={15} /> <h2>Open incidents</h2><span>{incidentRows.length}</span></header>
        {incidentRows.length ? incidentRows.map(({ incident, storageKey }) => <div key={incident.id} className="ops-row failed">
          <b>{incident.title}</b>
          <span>{storageKey} · {incident.kind}</span>
          <small>{incident.createdAt.toLocaleString()}</small>
        </div>) : <p className="ops-empty">No open incidents.</p>}
      </section>
      <section className="panel ops-table">
        <header><Radio size={15} /> <h2>Runners</h2><span>{runnerRows.filter((runner) => runner.status === "online").length} online</span></header>
        {runnerRows.length ? runnerRows.map((runner) => <div key={runner.id} className={`ops-row ${runner.status === "online" ? "completed" : "queued"}`}>
          <b>{runner.name}</b>
          <span>{runner.status}{runner.labels.length ? ` · ${runner.labels.join(", ")}` : ""}</span>
          <small>{runner.lastSeenAt ? `seen ${runner.lastSeenAt.toLocaleString()}` : "never seen"}</small>
        </div>) : <p className="ops-empty">No self-hosted runners are registered.</p>}
      </section>
    </div>
  </main>;
}
