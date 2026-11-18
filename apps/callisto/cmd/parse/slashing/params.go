package slashing

import (
	"github.com/spf13/cobra"

	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/slashing"
	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"
)

func paramsCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "params",
		Short: "Get the current parameters of the slashing module",
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

			// Build the slashing module
			slashingModule := slashing.NewModule(sources.SlashingSource, cdc, db)

			height, err := parseCtx.Node.LatestHeight()
			if err != nil {
				return err
			}

			return slashingModule.UpdateParams(height)
		},
	}
}
