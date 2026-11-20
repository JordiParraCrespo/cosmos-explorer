package builder

import (
	"fmt"

	"github.com/cosmos/cosmos-sdk/client"
	"github.com/cosmos/cosmos-sdk/codec"

	"github.com/xrplevm/cosmos-explorer/packages/juno/node"
	nodeconfig "github.com/xrplevm/cosmos-explorer/packages/juno/node/config"
	"github.com/xrplevm/cosmos-explorer/packages/juno/node/local"
	"github.com/xrplevm/cosmos-explorer/packages/juno/node/remote"
)

func BuildNode(cfg nodeconfig.Config, txConfig client.TxConfig, codec codec.Codec) (node.Node, error) {
	switch cfg.Type {
	case nodeconfig.TypeRemote:
		return remote.NewNode(cfg.Details.(*remote.Details))
	case nodeconfig.TypeLocal:
		return local.NewNode(cfg.Details.(*local.Details), txConfig, codec)
	case nodeconfig.TypeNone:
		return nil, nil

	default:
		return nil, fmt.Errorf("invalid node type: %s", cfg.Type)
	}
}
