package v6

import (
	"fmt"

	parse "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/database"
	"github.com/xrplevm/cosmos-explorer/packages/juno/database/postgresql"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	v6db "github.com/xrplevm/cosmos-explorer/apps/callisto/database/migrate/v6"
)

// RunMigration runs the migrations to v6
func RunMigration(parseConfig *parse.Config) error {
	cfg, err := GetConfig()
	if err != nil {
		return fmt.Errorf("error while reading config: %s", err)
	}

	if err := migrateDb(cfg, parseConfig); err != nil {
		return fmt.Errorf("error while migrating database: %s", err)
	}

	return nil
}

func migrateDb(cfg config.Config, parseConfig *parse.Config) error {
	databaseCtx := database.NewContext(cfg.Database, parseConfig.GetLogger())
	db, err := postgresql.Builder(databaseCtx)
	if err != nil {
		return fmt.Errorf("error while building the db: %s", err)
	}

	migrator := v6db.NewMigrator(db.(*postgresql.Database))
	return migrator.Migrate()
}
