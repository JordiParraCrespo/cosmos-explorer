package main

import (
	"github.com/xrplevm/cosmos-explorer/packages/juno/cmd"
	initcmd "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/init"
	parsetypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	startcmd "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/start"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/messages"

	migratecmd "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/migrate"
	parsecmd "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/types/config"
	evmconfig "github.com/xrplevm/cosmos-explorer/apps/callisto/types/evm_config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules"
)

func main() {
	initCfg := initcmd.NewConfig().
		WithConfigCreator(config.Creator)

	evmconfig.Cfg = evmconfig.ReadConfigFromFile()

	cdc := utils.GetCodec()
	parseCfg := parsetypes.NewConfig().
		WithDBBuilder(database.Builder(cdc)).
		WithRegistrar(modules.NewRegistrar(getAddressesParser(), cdc))

	cfg := cmd.NewConfig("callisto").
		WithInitConfig(initCfg).
		WithParseConfig(parseCfg)

	// Run the command
	rootCmd := cmd.RootCmd(cfg.GetName())

	rootCmd.AddCommand(
		cmd.VersionCmd(),
		initcmd.NewInitCmd(cfg.GetInitConfig()),
		parsecmd.NewParseCmd(cfg.GetParseConfig()),
		migratecmd.NewMigrateCmd(cfg.GetName(), cfg.GetParseConfig()),
		startcmd.NewStartCmd(cfg.GetParseConfig()),
	)

	executor := cmd.PrepareRootCmd(cfg.GetName(), rootCmd)
	err := executor.Execute()
	if err != nil {
		panic(err)
	}
}

// getAddressesParser returns the messages parser that should be used to get the users involved in
// a specific message.
// This should be edited by custom implementations if needed.
func getAddressesParser() messages.MessageAddressesParser {
	return messages.JoinMessageParsers(
		messages.CosmosMessageAddressesParser,
	)
}
