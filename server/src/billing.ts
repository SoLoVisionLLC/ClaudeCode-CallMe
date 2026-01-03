/**
 * Subscription Billing Configuration
 *
 * $20/month includes 60 minutes
 */

export interface SubscriptionPlan {
  monthlyPriceCents: number;
  monthlyMinutes: number;
}

let plan: SubscriptionPlan = {
  monthlyPriceCents: 2000,  // $20
  monthlyMinutes: 60,       // 60 minutes
};

export function loadBillingConfig(): void {
  plan = {
    monthlyPriceCents: parseInt(process.env.MONTHLY_PRICE_CENTS || '2000', 10),
    monthlyMinutes: parseInt(process.env.MONTHLY_MINUTES || '60', 10),
  };

  console.error(`Plan: $${plan.monthlyPriceCents / 100}/mo, ${plan.monthlyMinutes} minutes`);
}

export function getMonthlyPriceCents(): number {
  return plan.monthlyPriceCents;
}

export function getMonthlyMinutes(): number {
  return plan.monthlyMinutes;
}

export function getMinutesRemaining(minutesUsed: number): number {
  return Math.max(0, plan.monthlyMinutes - minutesUsed);
}

export function hasMinutesRemaining(minutesUsed: number): boolean {
  return minutesUsed < plan.monthlyMinutes;
}
