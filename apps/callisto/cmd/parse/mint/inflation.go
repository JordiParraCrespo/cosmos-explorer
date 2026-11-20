package mint

import (
	"fmt"

	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/mint"
	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"
)

// inflationCmd returns the Cobra command allowing to refresh x/mint inflation
func inflationCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "inflation",
		Short: "Refresh inflation",
		RunE: func(cmd *cobra.Command, args []string) error {
			parseCtx, err := parsecmdtypes.GetParserContext(config.Cfg, parseConfig)
			if err != nil {
				return err
			}

			cdc := utils.GetCodec()
			sources, err := modulestypes.BuildSources(config.Cfg.Node, cdc)
			if err != nil {
				return err
			}

			// Get the database
			db := database.Cast(parseCtx.Database)

			// Build mint module
			mintModule := mint.NewModule(sources.MintSource, cdc, db)

			err = mintModule.UpdateInflation()
			if err != nil {
				return fmt.Errorf("error while updating inflation: %s", err)
			}

			return nil
		},
	}
}
