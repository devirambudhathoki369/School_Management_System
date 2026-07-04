"""
The 34 legacy ledger groups (accounting/constants/ledger_groups.py in
Cent-New), kept as a seeded reference table. Codes are stable legacy ids —
ledgers FK to them and legacy data imports by code.

Each group carries its natural balance side, category and cash-flow class.
The IE side map reproduces the legacy IE_TYPES report-time derivation:
on an income/expense voucher a line's Dr/Cr side follows its ledger's
category. The new schema derives the side once at write time and stores it.
"""

DR, CR = "dr", "cr"
INCOME, EXPENSE, ASSET, LIABILITY, EQUITY = (
    "income", "expense", "asset", "liability", "equity"
)
OPERATING, INVESTING, FINANCING = "operating", "investing", "financing"

# code: (name, natural_side, category, cash_flow)
LEDGER_GROUPS: dict[int, tuple[str, str, str, str | None]] = {
    1: ("Account Payable", CR, LIABILITY, OPERATING),
    2: ("Account Receivable", DR, ASSET, OPERATING),
    3: ("Bank Account", DR, ASSET, None),
    4: ("Bank Occ Account", CR, LIABILITY, None),
    5: ("Bank OD Account", CR, LIABILITY, None),
    6: ("Capital A/C", CR, EQUITY, FINANCING),
    7: ("Cash in Hand", DR, ASSET, None),
    8: ("Current Assets", DR, ASSET, OPERATING),
    9: ("Current Liabilities", CR, LIABILITY, OPERATING),
    10: ("Direct Expenses", DR, EXPENSE, OPERATING),
    11: ("Direct Income", CR, INCOME, OPERATING),
    12: ("Duties and Tax", DR, EXPENSE, OPERATING),
    13: ("Fix Assets", DR, ASSET, INVESTING),
    14: ("Indirect Expenses", DR, EXPENSE, OPERATING),
    15: ("Indirect Income", CR, INCOME, OPERATING),
    16: ("Investment", DR, ASSET, INVESTING),
    17: ("Loan and Advance", DR, ASSET, INVESTING),
    18: ("Loans", CR, LIABILITY, FINANCING),
    19: ("Provision", CR, LIABILITY, OPERATING),
    20: ("Purchase", DR, EXPENSE, OPERATING),
    21: ("Sales", CR, INCOME, OPERATING),
    22: ("Mics, Expenses (assets)", DR, EXPENSE, OPERATING),
    23: ("Reserve and surplus", CR, EQUITY, FINANCING),
    24: ("Retained Earning", CR, EQUITY, FINANCING),
    25: ("Stock in Hand (closing stock)", DR, ASSET, OPERATING),
    26: ("Sundry Creditors", CR, LIABILITY, OPERATING),
    27: ("Sundry Debtors", DR, ASSET, OPERATING),
    28: ("Suspense A/C", DR, LIABILITY, None),
    29: ("Unsecured Loan", CR, LIABILITY, FINANCING),
    30: ("Stock in Hand (opening stock)", DR, ASSET, OPERATING),
    31: ("Secured Loan", CR, LIABILITY, FINANCING),
    32: ("Bonus Share", DR, EQUITY, FINANCING),
    33: ("Short Term Loan", CR, LIABILITY, FINANCING),
    34: ("Share Capital", CR, EQUITY, FINANCING),
}

# Legacy IE_TYPES: category -> line side on an income / expense voucher.
INCOME_VOUCHER_SIDES = {
    ASSET: DR,       # money received into cash/bank
    EXPENSE: DR,     # rare on income vouchers, legacy safe default
    INCOME: CR,
    LIABILITY: CR,
    EQUITY: CR,
}
EXPENSE_VOUCHER_SIDES = {
    ASSET: CR,       # money paid out of cash/bank
    INCOME: CR,
    EQUITY: CR,
    EXPENSE: DR,
    LIABILITY: DR,
}
