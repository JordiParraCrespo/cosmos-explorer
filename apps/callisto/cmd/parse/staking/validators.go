package staking

import (
	"fmt"

	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"

	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking"
)

// validatorsCmd returns a Cobra command that allows to fix the validator infos for all validators.
func validatorsCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "validators",
		Short: "Fix the information about validators taking them from the latest known height",
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

			// Build the staking module
			stakingModule := staking.NewModule(sources.StakingSource, cdc, db)

			// Get latest height
			height, err := parseCtx.Node.LatestHeight()
			if err != nil {
				return fmt.Errorf("error while getting latest block height: %s", err)
			}

			err = stakingModule.RefreshAllValidatorInfos(height)
			if err != nil {
				return fmt.Errorf("error while refreshing all validators infos: %s", err)
			}

			return nil
		},
	}
}
