package v6

import (
	"github.com/jmoiron/sqlx"

	"github.com/xrplevm/cosmos-explorer/packages/juno/database"
	"github.com/xrplevm/cosmos-explorer/packages/juno/database/postgresql"
)

var _ database.Migrator = &Migrator{}

// Migrator represents the database migrator that should be used to migrate from v5 to v6
type Migrator struct {
	SQL *sqlx.DB
}

func NewMigrator(db *postgresql.Database) *Migrator {
	return &Migrator{
		SQL: db.SQL,
	}
}
