package actions

import (
	"time"

	"github.com/cosmos/cosmos-sdk/codec"
	authtx "github.com/cosmos/cosmos-sdk/x/auth/tx"
	"github.com/rs/zerolog/log"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules"
	"github.com/xrplevm/cosmos-explorer/packages/juno/node"
	"github.com/xrplevm/cosmos-explorer/packages/juno/node/builder"
	nodeconfig "github.com/xrplevm/cosmos-explorer/packages/juno/node/config"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
)

const (
	ModuleName = "actions"
)

var (
	_ modules.Module                     = &Module{}
	_ modules.AdditionalOperationsModule = &Module{}
)

type Module struct {
	cfg     *Config
	node    node.Node
	sources *modulestypes.Sources
}

func NewModule(cfg config.Config, cdc codec.Codec, sources *modulestypes.Sources) *Module {
	bz, err := cfg.GetBytes()
	if err != nil {
		panic(err)
	}

	actionsCfg, err := ParseConfig(bz)
	if err != nil {
		panic(err)
	}

	nodeCfg := cfg.Node
	if actionsCfg.Node != nil {
		nodeCfg = nodeconfig.NewConfig(nodeconfig.TypeRemote, actionsCfg.Node)
	}

	var node node.Node
	if cfg.Node.Type == nodeconfig.TypeLocal {
		log.Warn().Str("module", ModuleName).Msg("local node is not supported for actions module, please ensure actions module is removed from the configuration")

		// Sleep for 3 seconds to allow the user to see the warning
		time.Sleep(3 * time.Second)
	} else {
		// Build the node
		txConfig := authtx.NewTxConfig(cdc, authtx.DefaultSignModes)
		junoNode, err := builder.BuildNode(nodeCfg, txConfig, cdc)
		if err != nil {
			panic(err)
		}

		node = junoNode
	}

	return &Module{
		cfg:     actionsCfg,
		node:    node,
		sources: sources,
	}
}

func (m *Module) Name() string {
	return ModuleName
}
