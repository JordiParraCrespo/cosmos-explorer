package auth

import (
	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
)

// NewAuthCmd returns the Cobra command that allows to fix all the things related to the x/auth module
func NewAuthCmd(parseCfg *parsecmdtypes.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Fix things related to the x/auth module",
	}

	cmd.AddCommand(
		vestingCmd(parseCfg),
	)

	return cmd
}
