package v4

import (
	databaseconfig "github.com/xrplevm/cosmos-explorer/packages/juno/database/config"
	loggingconfig "github.com/xrplevm/cosmos-explorer/packages/juno/logging/config"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/pruning"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/telemetry"
	nodeconfig "github.com/xrplevm/cosmos-explorer/packages/juno/node/config"
	parserconfig "github.com/xrplevm/cosmos-explorer/packages/juno/parser/config"
	pricefeedconfig "github.com/xrplevm/cosmos-explorer/packages/juno/pricefeed"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"
)

// Config defines all necessary juno configuration parameters.
type Config struct {
	Chain    config.ChainConfig    `yaml:"chain"`
	Node     nodeconfig.Config     `yaml:"node"`
	Parser   parserconfig.Config   `yaml:"parsing"`
	Database databaseconfig.Config `yaml:"database"`
	Logging  loggingconfig.Config  `yaml:"logging"`

	// The following are there to support modules which config are present if they are enabled

	Telemetry *telemetry.Config       `yaml:"telemetry,omitempty"`
	Pruning   *pruning.Config         `yaml:"pruning,omitempty"`
	PriceFeed *pricefeedconfig.Config `yaml:"pricefeed,omitempty"`
}
