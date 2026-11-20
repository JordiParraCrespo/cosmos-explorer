package staking

import (
	"fmt"

	"github.com/spf13/cobra"
	parsecmdtypes "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"
	"github.com/xrplevm/cosmos-explorer/packages/juno/types/config"

	"github.com/xrplevm/cosmos-explorer/apps/callisto/database"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/modules/staking"
	modulestypes "github.com/xrplevm/cosmos-explorer/apps/callisto/modules/types"
	"github.com/xrplevm/cosmos-explorer/apps/callisto/utils"
)

// poolCmd returns the Cobra command allowing to refresh x/staking pool
func poolCmd(parseConfig *parsecmdtypes.Config) *cobra.Command {
	return &cobra.Command{
		Use:   "pool",
		Short: "Refresh staking pool",
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

			// Build staking module
			stakingModule := staking.NewModule(sources.StakingSource, cdc, db)

			err = stakingModule.UpdateStakingPool()
			if err != nil {
				return fmt.Errorf("error while updating staking pool: %s", err)
			}

			return nil
		},
	}
}
