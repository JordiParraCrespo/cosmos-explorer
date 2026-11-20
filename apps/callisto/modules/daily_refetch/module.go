package daily_refetch

import (
	"github.com/xrplevm/cosmos-explorer/packages/juno/node"

	callistodb "github.com/xrplevm/cosmos-explorer/apps/callisto/database"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
)

var (
	_ modules.Module                   = &Module{}
	_ modules.PeriodicOperationsModule = &Module{}
)

type Module struct {
	node     node.Node
	database *callistodb.Db
}

// NewModule builds a new Module instance
func NewModule(
	node node.Node,
	database *callistodb.Db,
) *Module {
	return &Module{
		node:     node,
		database: database,
	}
}

// Name implements modules.Module
func (m *Module) Name() string {
	return "daily refetch"
}
