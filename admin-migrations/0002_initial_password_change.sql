-- Operator-provisioned temporary credentials cannot open the workspace until changed.
ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
