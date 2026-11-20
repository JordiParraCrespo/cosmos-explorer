package bank

import (
	"fmt"

	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"

	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/bank"
)

// supplyCmd returns the Cobra command allowing to refresh x/bank total supply
func supplyCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "supply",
		Short: "Refresh total supply",
		RunE: func(cmd *cobra.Command, args []string) error {
			parseCtx, err := parsecmdtypes.GetParserContext(config.Cfg, parseConfig)
			if err != nil {
				return err
			}

			sources, err := modulestypes.BuildSources(config.Cfg.Node, utils.GetCodec())
			if err != nil {
				return err
			}

			// Get the database
			db := database.Cast(parseCtx.Database)

			// Build bank module
			bankModule := bank.NewModule(nil, sources.BankSource, utils.GetCodec(), db)

			err = bankModule.UpdateSupply()
			if err != nil {
				return fmt.Errorf("error while getting latest bank supply: %s", err)
			}

			return nil
		},
	}
}
