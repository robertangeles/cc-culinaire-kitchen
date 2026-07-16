BEGIN;

-- Wine batch 02 (org 2, FOH Consumable / Spirits, base_unit ml, no supplier yet)
INSERT INTO ingredient (organisation_id, ingredient_name, ingredient_category, item_type, base_unit, unit_cost, pack_qty, description) VALUES
  (2, 'Jean-Luc Mouillard', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0640, 750, 'Champagne'),
  (2, 'Taittinger', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.1107, 750, 'Champagne'),
  (2, 'Billecart-Salmon', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.1840, 750, 'Champagne'),
  (2, 'Huré Frères (Half Bottle)', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.1200, 375, 'Champagne'),
  (2, 'Sébastien Petit Chablis', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0580, 750, 'White'),
  (2, 'Chardonnay (South Australia)', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0256, 750, 'White'),
  (2, 'Pinot Grigio (Tasmania)', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0267, 750, 'White'),
  (2, 'Riesling', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0315, 750, 'White'),
  (2, 'Belicard Blanc Chardonnay', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0793, 750, 'White'),
  (2, 'Sancerre', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0556, 750, 'White'),
  (2, 'Lafon Languedoc', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0255, 750, 'Rosé'),
  (2, 'Luke Lambert Yarra Valley', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0293, 750, 'Rosé'),
  (2, 'Bourgogne Pinot Noir', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0467, 750, 'Red'),
  (2, 'Côte du Rhône', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0287, 750, 'Red'),
  (2, 'Bordeaux', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0327, 750, 'Red'),
  (2, 'Yarra Valley Pinot Noir', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0315, 750, 'Red'),
  (2, 'Eleventh Hour Barossa Shiraz', 'spirits', 'FOH_CONSUMABLE', 'ml', 0.0411, 750, 'Red')
ON CONFLICT (organisation_id, ingredient_name) DO NOTHING;

COMMIT;
