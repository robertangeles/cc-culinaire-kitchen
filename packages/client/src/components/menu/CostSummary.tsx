import { DollarSign } from "lucide-react";

interface CostSummaryProps {
  totalBatchCost: number;
  ingredientCount: number;
  servings: number;
  qPct: number;
  foodCostWithQ: number;
  salePack: number;
  foodCostPerSale: number;
  foodCostPct: number;
  contributionMargin: number;
}

export function CostSummary({
  totalBatchCost,
  ingredientCount,
  servings,
  qPct,
  foodCostWithQ,
  salePack,
  foodCostPerSale,
  foodCostPct,
  contributionMargin,
}: CostSummaryProps) {
  return (
    <div className="bg-dark rounded-xl border border-dark-200 p-4">
      <div className="flex items-center gap-2 mb-3">
        <DollarSign className="size-4 text-gold" />
        <h4 className="text-sm font-semibold text-[#FAFAFA]">Cost Summary</h4>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <p className="text-[10px] uppercase text-dark-500 mb-0.5">Batch Cost</p>
          <p className="text-lg font-bold text-[#FAFAFA]">${totalBatchCost.toFixed(2)}</p>
          <p className="text-[10px] text-dark-500">
            Sum of {ingredientCount} ingredient line{ingredientCount === 1 ? "" : "s"}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-dark-500 mb-0.5">Food Cost / Serving</p>
          <p className="text-lg font-bold text-[#FAFAFA]">${foodCostWithQ.toFixed(2)}</p>
          {(servings > 1 || qPct > 0) && (
            <p className="text-[10px] text-dark-500">
              {servings > 1 && <>÷ {servings} servings</>}
              {servings > 1 && qPct > 0 && " · "}
              {qPct > 0 && <>+{qPct}% Q Factor</>}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase text-dark-500 mb-0.5">Food Cost %</p>
          <p className={`text-lg font-bold ${foodCostPct > 35 ? "text-red-400" : "text-[#FAFAFA]"}`}>
            {foodCostPct.toFixed(1)}%
          </p>
          {salePack > 1 && (
            <p className="text-[10px] text-dark-500">
              ${foodCostPerSale.toFixed(2)} per sale of {salePack}
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase text-dark-500 mb-0.5">Contribution Margin</p>
          <p className={`text-lg font-bold ${contributionMargin < 0 ? "text-red-400" : "text-green-400"}`}>
            ${contributionMargin.toFixed(2)}
          </p>
          {salePack > 1 && (
            <p className="text-[10px] text-dark-500">per sale of {salePack} servings</p>
          )}
        </div>
      </div>
    </div>
  );
}
