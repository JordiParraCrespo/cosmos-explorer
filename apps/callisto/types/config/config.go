package config

import (
	"github.com/spf13/cobra"
	initcmd "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/init"
	junoconfig "github.com/xrplevm/cosmos-explorer/packages/juno/types/config"
	"gopkg.in/yaml.v3"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/actions"
)

// Config represents the Callisto configuration
type Config struct {
	JunoConfig    junoconfig.Config `yaml:"-,inline"`
	ActionsConfig *actions.Config   `yaml:"actions"`
}

// NewConfig returns a new Config instance
func NewConfig(junoCfg junoconfig.Config, actionsCfg *actions.Config) Config {
	return Config{
		JunoConfig:    junoCfg,
		ActionsConfig: actionsCfg,
	}
}

// GetBytes implements WritableConfig
func (c Config) GetBytes() ([]byte, error) {
	return yaml.Marshal(&c)
}

// Creator represents a configuration creator
func Creator(_ *cobra.Command) initcmd.WritableConfig {
	return NewConfig(junoconfig.DefaultConfig(), actions.DefaultConfig())
}
