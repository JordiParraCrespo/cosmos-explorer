package v5

import (
	"fmt"

	parse "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/database"
	"github.com/xrplevm/cosmos-explorer/packages/juno/database/postgresql"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	v5db "github.com/xrplevm/cosmos-explorer/apps/callisto/database/migrate/v5"
)

// RunMigration runs the migrations to v5
func RunMigration(parseConfig *parse.Config) error {
	cfg, err := GetConfig()
	if err != nil {
		return fmt.Errorf("error while reading config: %s", err)
	}

	// Migrate the database
	err = migrateDb(cfg, parseConfig)
	if err != nil {
		return fmt.Errorf("error while migrating database: %s", err)
	}

	return nil
}

func migrateDb(cfg config.Config, parseConfig *parse.Config) error {
	// Get the db
	databaseCtx := database.NewContext(cfg.Database, parseConfig.GetLogger())
	db, err := postgresql.Builder(databaseCtx)
	if err != nil {
		return fmt.Errorf("error while building the db: %s", err)
	}

	// Build the migrator and perform the migrations
	migrator := v5db.NewMigrator(db.(*postgresql.Database))
	return migrator.Migrate()
}
