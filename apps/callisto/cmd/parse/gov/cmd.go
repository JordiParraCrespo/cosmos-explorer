package gov

import (
	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
)

// NewGovCmd returns the Cobra command allowing to fix various things related to the x/gov module
func NewGovCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "gov",
		Short: "Fix things related to the x/gov module",
	}

	cmd.AddCommand(
		proposalCmd(parseConfig),
		paramsCmd(parseConfig),
	)

	return cmd
}
