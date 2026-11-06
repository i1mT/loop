export const ROUTING_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS project_machines (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    machine_id TEXT NOT NULL, position INTEGER NOT NULL, local_path TEXT,
    PRIMARY KEY(project_id,machine_id))`,
  `CREATE INDEX IF NOT EXISTS project_machines_machine_idx ON project_machines(machine_id)`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS dispatch_cursor INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE projects ADD COLUMN IF NOT EXISTS binding_revision INTEGER NOT NULL DEFAULT 0`,
  `INSERT INTO project_machines(project_id,machine_id,position,local_path)
    SELECT id,machine_id,0,local_path FROM projects p WHERE machine_id IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM project_machines b WHERE b.project_id=p.id)
    ON CONFLICT DO NOTHING`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_path TEXT`,
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS execution_snapshot INTEGER NOT NULL DEFAULT 0`,
  `UPDATE tasks t SET execution_path=p.local_path,execution_snapshot=1 FROM projects p
    WHERE p.id=t.project_id AND t.execution_snapshot=0`,
  `CREATE INDEX IF NOT EXISTS tasks_machine_dispatch_idx ON tasks(machine_id,stage)`,
];
