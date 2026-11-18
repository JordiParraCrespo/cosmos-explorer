package types

import (
	"fmt"

	"github.com/xrplevm/cosmos-explorer/packages/juno/node/remote"

	"github.com/cosmos/cosmos-sdk/codec"
	banktypes "github.com/cosmos/cosmos-sdk/x/bank/types"
	distrkeeper "github.com/cosmos/cosmos-sdk/x/distribution/keeper"
	distrtypes "github.com/cosmos/cosmos-sdk/x/distribution/types"
	govkeeper "github.com/cosmos/cosmos-sdk/x/gov/keeper"
	govtypesv1 "github.com/cosmos/cosmos-sdk/x/gov/types/v1"
	mintkeeper "github.com/cosmos/cosmos-sdk/x/mint/keeper"
	minttypes "github.com/cosmos/cosmos-sdk/x/mint/types"
	slashingtypes "github.com/cosmos/cosmos-sdk/x/slashing/types"
	stakingkeeper "github.com/cosmos/cosmos-sdk/x/staking/keeper"
	stakingtypes "github.com/cosmos/cosmos-sdk/x/staking/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/node/local"

	nodeconfig "github.com/xrplevm/cosmos-explorer/packages/juno/node/config"

	banksource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/bank/source"
	localbanksource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/bank/source/local"
	remotebanksource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/bank/source/remote"
	distrsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/distribution/source"
	localdistrsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/distribution/source/local"
	remotedistrsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/distribution/source/remote"
	govsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/gov/source"
	localgovsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/gov/source/local"
	remotegovsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/gov/source/remote"
	mintsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/mint/source"
	localmintsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/mint/source/local"
	remotemintsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/mint/source/remote"
	slashingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/slashing/source"
	localslashingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/slashing/source/local"
	remoteslashingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/slashing/source/remote"
	stakingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking/source"
	localstakingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking/source/local"
	remotestakingsource "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking/source/remote"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils/simapp"
)

type Sources struct {
	BankSource     banksource.Source
	DistrSource    distrsource.Source
	GovSource      govsource.Source
	MintSource     mintsource.Source
	SlashingSource slashingsource.Source
	StakingSource  stakingsource.Source
}

func BuildSources(nodeCfg nodeconfig.Config, cdc codec.Codec) (*Sources, error) {
	switch cfg := nodeCfg.Details.(type) {
	case *remote.Details:
		return buildRemoteSources(cfg)
	case *local.Details:
		return buildLocalSources(cfg, cdc)

	default:
		return nil, fmt.Errorf("invalid configuration type: %T", cfg)
	}
}

func buildLocalSources(cfg *local.Details, cdc codec.Codec) (*Sources, error) {
	source, err := local.NewSource(cfg.Home, cdc)
	if err != nil {
		return nil, err
	}

	app := simapp.NewSimApp(cdc)

	sources := &Sources{
		BankSource:     localbanksource.NewSource(source, banktypes.QueryServer(app.BankKeeper)),
		DistrSource:    localdistrsource.NewSource(source, distrkeeper.NewQuerier(app.DistrKeeper)),
		GovSource:      localgovsource.NewSource(source, govkeeper.NewQueryServer(&app.GovKeeper)),
		MintSource:     localmintsource.NewSource(source, mintkeeper.NewQueryServerImpl(app.MintKeeper)),
		SlashingSource: localslashingsource.NewSource(source, slashingtypes.QueryServer(app.SlashingKeeper)),
		StakingSource:  localstakingsource.NewSource(source, stakingkeeper.Querier{Keeper: app.StakingKeeper}),
	}

	// Mount and initialize the stores
	err = source.MountKVStores(app, "keys")
	if err != nil {
		return nil, err
	}

	err = source.InitStores()
	if err != nil {
		return nil, err
	}

	return sources, nil
}

func buildRemoteSources(cfg *remote.Details) (*Sources, error) {
	source, err := remote.NewSource(cfg.GRPC)
	if err != nil {
		return nil, fmt.Errorf("error while creating remote source: %s", err)
	}

	return &Sources{
		BankSource:     remotebanksource.NewSource(source, banktypes.NewQueryClient(source.GrpcConn)),
		DistrSource:    remotedistrsource.NewSource(source, distrtypes.NewQueryClient(source.GrpcConn)),
		GovSource:      remotegovsource.NewSource(source, govtypesv1.NewQueryClient(source.GrpcConn)),
		MintSource:     remotemintsource.NewSource(source, minttypes.NewQueryClient(source.GrpcConn)),
		SlashingSource: remoteslashingsource.NewSource(source, slashingtypes.NewQueryClient(source.GrpcConn)),
		StakingSource:  remotestakingsource.NewSource(source, stakingtypes.NewQueryClient(source.GrpcConn)),
	}, nil
}
