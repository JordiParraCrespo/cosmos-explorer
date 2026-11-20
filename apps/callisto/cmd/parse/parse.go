package parse

import (
	"github.com/spf13/cobra"
	parse "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/types"

	parseblocks "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/blocks"

	parsegenesis "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/genesis"

	parsetransaction "github.com/xrplevm/cosmos-explorer/packages/juno/cmd/parse/transactions"

	parseauth "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/auth"
	parsebank "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/bank"
	parsedistribution "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/distribution"
	parsefeegrant "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/feegrant"
	parsegov "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/gov"
	parsemint "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/mint"
	parsepricefeed "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/pricefeed"
	parseslashing "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/slashing"
	parsestaking "github.com/xrplevm/cosmos-explorer/apps/callisto/cmd/parse/staking"
)

// NewParseCmd returns the Cobra command allowing to parse some chain data without having to re-sync the whole database
func NewParseCmd(parseCfg *parse.Config) *cobra.Command {
	cmd := &cobra.Command{
		Use:               "parse",
		Short:             "Parse some data without the need to re-syncing the whole database from scratch",
		PersistentPreRunE: runPersistentPreRuns(parse.ReadConfigPreRunE(parseCfg)),
	}

	cmd.AddCommand(
		parseauth.NewAuthCmd(parseCfg),
		parsebank.NewBankCmd(parseCfg),
		parseblocks.NewBlocksCmd(parseCfg),
		parsedistribution.NewDistributionCmd(parseCfg),
		parsefeegrant.NewFeegrantCmd(parseCfg),
		parsegenesis.NewGenesisCmd(parseCfg),
		parsegov.NewGovCmd(parseCfg),
		parsemint.NewMintCmd(parseCfg),
		parsepricefeed.NewPricefeedCmd(parseCfg),
		parsestaking.NewStakingCmd(parseCfg),
		parsetransaction.NewTransactionsCmd(parseCfg),
		parseslashing.NewSlashingCmd(parseCfg),
	)

	return cmd
}

func runPersistentPreRuns(preRun func(_ *cobra.Command, _ []string) error) func(_ *cobra.Command, _ []string) error {
	return func(cmd *cobra.Command, args []string) error {
		if root := cmd.Root(); root != nil {
			if root.PersistentPreRunE != nil {
				err := root.PersistentPreRunE(root, args)
				if err != nil {
					return err
				}
			}
		}

		return preRun(cmd, args)
	}
}
