package modules

import (
	"github.com/cosmos/cosmos-sdk/codec"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/actions"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/pruning"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/telemetry"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/slashing"

	jmodules "github.com/xrplevm/cosmos-explorer/packages/juno/modules"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/messages"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/registrar"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/auth"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/bank"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/consensus"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/distribution"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/feegrant"

	juno "github.com/xrplevm/cosmos-explorer/packages/juno/types"

	dailyrefetch "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/daily_refetch"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/gov"
	messagetype "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/message_type"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/mint"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/modules"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/pricefeed"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/upgrade"
)

// UniqueAddressesParser returns a wrapper around the given parser that removes all duplicated addresses
func UniqueAddressesParser(parser messages.MessageAddressesParser) messages.MessageAddressesParser {
	return func(tx *juno.Transaction) ([]string, error) {
		addresses, err := parser(tx)
		if err != nil {
			return nil, err
		}

		return utils.RemoveDuplicateValues(addresses), nil
	}
}

// --------------------------------------------------------------------------------------------------------------------

var (
	_ registrar.Registrar = &Registrar{}
)

// Registrar represents the modules.Registrar that allows to register all modules that are supported by BigDipper
type Registrar struct {
	parser messages.MessageAddressesParser
	cdc    codec.Codec
}

// NewRegistrar allows to build a new Registrar instance
func NewRegistrar(parser messages.MessageAddressesParser, cdc codec.Codec) *Registrar {
	return &Registrar{
		parser: UniqueAddressesParser(parser),
		cdc:    cdc,
	}
}

// BuildModules implements modules.Registrar
func (r *Registrar) BuildModules(ctx registrar.Context) jmodules.Modules {
	db := database.Cast(ctx.Database)

	sources, err := types.BuildSources(ctx.JunoConfig.Node, r.cdc)
	if err != nil {
		panic(err)
	}

	actionsModule := actions.NewModule(ctx.JunoConfig, r.cdc, sources)
	authModule := auth.NewModule(r.parser, r.cdc, db)
	bankModule := bank.NewModule(r.parser, sources.BankSource, r.cdc, db)
	consensusModule := consensus.NewModule(db)
	dailyRefetchModule := dailyrefetch.NewModule(ctx.Proxy, db)
	distrModule := distribution.NewModule(sources.DistrSource, r.cdc, db)
	feegrantModule := feegrant.NewModule(r.cdc, db)
	messagetypeModule := messagetype.NewModule(r.parser, r.cdc, db)
	mintModule := mint.NewModule(sources.MintSource, r.cdc, db)
	slashingModule := slashing.NewModule(sources.SlashingSource, r.cdc, db)
	stakingModule := staking.NewModule(sources.StakingSource, r.cdc, db)
	govModule := gov.NewModule(sources.GovSource, distrModule, mintModule, slashingModule, stakingModule, r.cdc, db)
	upgradeModule := upgrade.NewModule(db, stakingModule)

	return []jmodules.Module{
		messages.NewModule(r.parser, ctx.Database),
		telemetry.NewModule(ctx.JunoConfig),
		pruning.NewModule(ctx.JunoConfig, db, ctx.Logger),

		actionsModule,
		authModule,
		bankModule,
		consensusModule,
		dailyRefetchModule,
		distrModule,
		feegrantModule,
		govModule,
		mintModule,
		messagetypeModule,
		modules.NewModule(ctx.JunoConfig.Chain, db),
		pricefeed.NewModule(ctx.JunoConfig, r.cdc, db),
		slashingModule,
		stakingModule,
		upgradeModule,
	}
}
