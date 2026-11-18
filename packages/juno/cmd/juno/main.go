package main

import (
	"os"

	"github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"

	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/messages"
	"github.com/xrplevm/cosmos-explorer/packages/juno/modules/registrar"

	"github.com/xrplevm/cosmos-explorer/packages/juno/cmd"
)

func main() {
	// JunoConfig the runner
	config := cmd.NewConfig("juno").
		WithParseConfig(types.NewConfig().
			WithRegistrar(registrar.NewDefaultRegistrar(
				messages.CosmosMessageAddressesParser,
			)),
		)

	// Run the commands and panic on any error
	exec := cmd.BuildDefaultExecutor(config)
	err := exec.Execute()
	if err != nil {
		os.Exit(1)
	}
}
