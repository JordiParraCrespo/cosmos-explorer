package pricefeed

import (
	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
)

// NewPricefeedCmd returns the Cobra command allowing to refresh pricefeed
func NewPricefeedCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "pricefeed",
		Short: "Fix things related to the pricefeed module",
	}

	cmd.AddCommand(
		priceCmd(parseConfig),
		priceHistoryCmd(parseConfig),
	)

	return cmd
}
