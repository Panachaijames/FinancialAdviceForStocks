import React from 'react';
import { theme } from '../../lib/theme.js';
import SavingsPanel from './SavingsPanel.jsx';
import RetirementPlanner from './RetirementPlanner.jsx';
import DividendProjection from './DividendProjection.jsx';
import DcaBacktest from './DcaBacktest.jsx';
import ThaiTaxPanel from './ThaiTaxPanel.jsx';
import SyncPanel from './SyncPanel.jsx';

/**
 * "Plan" view — future-planning tools: net worth & savings, a retirement /
 * financial-freedom plan with an AI deep-research path advisor, dividend-income
 * projection, a DCA backtest, and a Thai income-tax estimator. All amounts
 * respect the active display currency (except the DCA backtest, in the asset's
 * native price currency, and the Thai tax tool, in THB).
 * (The old standalone "Goal & Future Projection" panel was folded into the
 * retirement planner + AI advisor — it duplicated the same compound-growth math.)
 */
export default function PlanView() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: theme.space(5) }}>
      <SavingsPanel />
      <RetirementPlanner />
      <DividendProjection />
      <DcaBacktest />
      <ThaiTaxPanel />
      <SyncPanel />
    </div>
  );
}
