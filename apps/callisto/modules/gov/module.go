package gov

import (
	"github.com/cosmos/cosmos-sdk/codec"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"

	govsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/gov/source"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
)

var (
	_ modules.Module             = &Module{}
	_ modules.GenesisModule      = &Module{}
	_ modules.BlockModule        = &Module{}
	_ modules.MessageModule      = &Module{}
	_ modules.AuthzMessageModule = &Module{}
)

// Module represent x/gov module
type Module struct {
	cdc            codec.Codec
	db             *database.Db
	source         govsource.Source
	distrModule    DistrModule
	mintModule     MintModule
	slashingModule SlashingModule
	stakingModule  StakingModule
}

// NewModule returns a new Module instance
func NewModule(
	source govsource.Source,
	distrModule DistrModule,
	mintModule MintModule,
	slashingModule SlashingModule,
	stakingModule StakingModule,
	cdc codec.Codec,
	db *database.Db,
) *Module {
	return &Module{
		cdc:            cdc,
		source:         source,
		distrModule:    distrModule,
		mintModule:     mintModule,
		slashingModule: slashingModule,
		stakingModule:  stakingModule,
		db:             db,
	}
}

// Name implements modules.Module
func (m *Module) Name() string {
	return "gov"
}
