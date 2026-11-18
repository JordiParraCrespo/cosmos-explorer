package feegrant

import (
	"github.com/cosmos/cosmos-sdk/codec"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
)

var (
	_ modules.BlockModule        = &Module{}
	_ modules.Module             = &Module{}
	_ modules.MessageModule      = &Module{}
	_ modules.AuthzMessageModule = &Module{}
)

// Module represent x/feegrant module
type Module struct {
	cdc codec.Codec
	db  *database.Db
}

// NewModule returns a new Module instance
func NewModule(cdc codec.Codec, db *database.Db) *Module {
	return &Module{
		cdc: cdc,
		db:  db,
	}
}

// Name implements modules.Module
func (m *Module) Name() string {
	return "feegrant"
}
