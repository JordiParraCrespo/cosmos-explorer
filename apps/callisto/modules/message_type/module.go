package message_type

import (
	"github.com/cosmos/cosmos-sdk/codec"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/messages"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
)

var (
	_ modules.Module        = &Module{}
	_ modules.MessageModule = &Module{}
)

type Module struct {
	cdc    codec.Codec
	db     *database.Db
	parser messages.MessageAddressesParser
}

func NewModule(parser messages.MessageAddressesParser, cdc codec.Codec, db *database.Db) *Module {
	return &Module{
		parser: parser,
		cdc:    cdc,
		db:     db,
	}
}

// Name implements modules.Module
func (m *Module) Name() string {
	return "message_type"
}
