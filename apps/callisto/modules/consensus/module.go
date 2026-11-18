package consensus

import (
	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
)

var (
	_ modules.Module                   = &Module{}
	_ modules.PeriodicOperationsModule = &Module{}
	_ modules.GenesisModule            = &Module{}
	_ modules.BlockModule              = &Module{}
)

// Module implements the consensus utils
type Module struct {
	db *database.Db
}

// NewModule builds a new Module instance
func NewModule(db *database.Db) *Module {
	return &Module{
		db: db,
	}
}

// Name implements modules.Module
func (m *Module) Name() string {
	return "consensus"
}
