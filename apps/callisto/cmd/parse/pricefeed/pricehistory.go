package pricefeed

import (
	"fmt"

	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/pricefeed"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"
)

// priceHistoryCmd returns the Cobra command allowing to store token price history
func priceHistoryCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "history",
		Short: "Store token price history",
		RunE: func(cmd *cobra.Command, args []string) error {
			parseCtx, err := parsecmdtypes.GetParserContext(config.Cfg, parseConfig)
			if err != nil {
				return err
			}

			cdc := utils.GetCodec()

			// Get the database
			db := database.Cast(parseCtx.Database)

			// Build pricefeed module
			pricefeedModule := pricefeed.NewModule(config.Cfg, cdc, db)

			err = pricefeedModule.RunAdditionalOperations()
			if err != nil {
				return fmt.Errorf("error while storing tokens: %s", err)
			}

			err = pricefeedModule.UpdatePricesHistory()
			if err != nil {
				return fmt.Errorf("error while updating price history: %s", err)
			}

			return nil
		},
	}
}
