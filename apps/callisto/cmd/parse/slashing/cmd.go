package slashing

import (
	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
)

// NewSlashingCmd returns the Cobra command allowing to fix various things related to the x/slashing module
func NewSlashingCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "slashing",
		Short: "Fix things related to the x/slashing module",
	}

	cmd.AddCommand(
		paramsCmd(parseConfig),
	)

	return cmd
}
