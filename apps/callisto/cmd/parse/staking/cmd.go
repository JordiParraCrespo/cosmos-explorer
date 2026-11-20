package staking

import (
	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
)

// NewStakingCmd returns the Cobra command that allows to fix all the things related to the x/staking module
func NewStakingCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "staking",
		Short: "Fix things related to the x/staking module",
	}

	cmd.AddCommand(
		poolCmd(parseConfig),
		validatorsCmd(parseConfig),
	)

	return cmd
}
