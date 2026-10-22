import {
  type ChainStats,
  type IBlockService,
  type IChainStatsService,
  type IValidatorService,
} from '@cosmos-explorer/core';
import { type Fetcher } from '@cosmos-explorer/utils';

import { mapAverageBlockTime } from '../mappers';
import { AVERAGE_BLOCK_TIME_QUERY } from '../queries';
import type { AverageBlockTimeResponse } from '../types';

export class CallistoChainStatsService implements IChainStatsService {
  constructor(
    private readonly fetcher: Fetcher,
    private readonly blockService: IBlockService,
    private readonly validatorService: IValidatorService
  ) {}

  async getChainStats(_input: { priceDenom: string }): Promise<ChainStats> {
    const [latestBlockResult, averageBlockTimeResult, validatorsResult] =
      await Promise.allSettled([
        this.blockService.getLatestBlock(),
        this.getAverageBlockTime(),
        this.validatorService.getValidatorCount(),
      ]);

    return {
      latestBlock:
        latestBlockResult.status === 'fulfilled' ? latestBlockResult.value : null,
      averageBlockTime:
        averageBlockTimeResult.status === 'fulfilled'
          ? averageBlockTimeResult.value
          : null,
      price: null,
      validators:
        validatorsResult.status === 'fulfilled'
          ? validatorsResult.value
          : { active: 0, total: 0 },
    };
  }

  private async getAverageBlockTime(): Promise<number | null> {
    const response = await this.fetcher.graphql<AverageBlockTimeResponse>({
      query: AVERAGE_BLOCK_TIME_QUERY,
      operationName: 'AverageBlockTime',
    });

    return mapAverageBlockTime(response);
  }
}
