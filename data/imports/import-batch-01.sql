BEGIN;

-- Ingredients (org 2, Almost French Pâtisserie)
INSERT INTO ingredient (organisation_id, ingredient_name, ingredient_category, item_type, base_unit) VALUES
  (2, 'Apples', 'produce', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Apricot', 'produce', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Pear', 'produce', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Spinach', 'produce', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Butter 25kg', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Muffins', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Salmon', 'proteins', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Raspberry Whole', 'frozen', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Euro Flour', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Plain Flour', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Caster Sugar', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Icing Sugar', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Drop Compound', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Dark Compound Chocolate', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Piping Bag', 'packaging', 'FOH_CONSUMABLE', 'each'),
  (2, 'Brie', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Salt', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Cocoa Powder', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Ice Cream Vanilla', 'frozen', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Ice Cream Chocolate', 'frozen', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Ice Cream Strawberry', 'frozen', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Ice Cream Caramel', 'frozen', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Sparkling Water', 'beverages', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Slivered Almonds', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Golden Syrup', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Condensed Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Tomato Sauce', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Pesto', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Relish', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Bocconcini', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Cream Cheese Spread', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Mayo', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Bacon', 'proteins', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Raspberry Jam', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Sugar Sticks', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Ground Cinnamon', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Marshmallow', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Label', 'packaging', 'FOH_CONSUMABLE', 'each'),
  (2, 'Shredded Coconut', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Marie Biscuits', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'White Compound Chocolate', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Chicken', 'proteins', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Cream Cheese', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Salami', 'proteins', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Smarties', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Lady Finger Biscuits', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Canola Spray', 'other', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Corn Flour', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Custard Powder', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Tortillas', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Mixed Herbs', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Biscuit Crumbs', 'bakery', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Mixed Spice', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Gluten Free Flour', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Baking Powder', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'English Mild Mustard', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Yogurt', 'dairy', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Mascarpone', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Brown Sugar', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Nutella', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Swiss Cheese Slices', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Ground Nutmeg', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Eggs', 'dairy', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Coffee Machine Cleaner', 'cleaning', 'OPERATIONAL_SUPPLY', 'each'),
  (2, 'Butter', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Baguette', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Bagel', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Doughnut', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Canelé', 'bakery', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Hot Glaze', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Guérande Salt', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Butter Sheet', 'dairy', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Fondant', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Gold Leaf Sheet', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Gold Powder', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Chocolate Baton', 'dry_goods', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Milk Chocolate', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Dark Chocolate', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'White Chocolate', 'dry_goods', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Lemon Puree', 'condiments', 'KITCHEN_INGREDIENT', 'each'),
  (2, 'Full Cream Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Skim Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Oat Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Soy Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Almond Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Tasty Shredded Cheese', 'dairy', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Organic Orange Juice', 'beverages', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Organic Apple Juice', 'beverages', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Thickened Cream', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Ham', 'proteins', 'KITCHEN_INGREDIENT', 'kg'),
  (2, 'Lactose-Free Milk', 'dairy', 'KITCHEN_INGREDIENT', 'l'),
  (2, 'Spring Water', 'beverages', 'KITCHEN_INGREDIENT', 'l')
ON CONFLICT (organisation_id, ingredient_name) DO NOTHING;

-- Supplier links
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Apples' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Apricot' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Pear' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Spinach' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Butter 25kg' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Muffins' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Salmon' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Raspberry Whole' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Euro Flour' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Plain Flour' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Caster Sugar' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Icing Sugar' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Drop Compound' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Dark Compound Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Piping Bag' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Brie' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Salt' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Cocoa Powder' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ice Cream Vanilla' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ice Cream Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ice Cream Strawberry' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ice Cream Caramel' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Sparkling Water' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Slivered Almonds' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Golden Syrup' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Condensed Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Tomato Sauce' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Pesto' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Relish' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Bocconcini' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Cream Cheese Spread' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Mayo' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Bacon' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Raspberry Jam' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Sugar Sticks' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ground Cinnamon' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Marshmallow' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Label' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Shredded Coconut' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Marie Biscuits' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='White Compound Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Chicken' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Cream Cheese' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Salami' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Smarties' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Lady Finger Biscuits' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Canola Spray' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Corn Flour' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Custard Powder' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Tortillas' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Mixed Herbs' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Biscuit Crumbs' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Mixed Spice' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Gluten Free Flour' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Baking Powder' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='English Mild Mustard' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Yogurt' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Mascarpone' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Brown Sugar' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Nutella' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Swiss Cheese Slices' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ground Nutmeg' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Eggs' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '5ab06a44-ea25-4279-b582-a6ce731d58e9'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Coffee Machine Cleaner' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '229abdf5-e7e9-4b18-8b42-9036a618595e'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Butter' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Baguette' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Bagel' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Doughnut' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Canelé' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Hot Glaze' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Guérande Salt' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Butter Sheet' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Fondant' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Gold Leaf Sheet' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Gold Powder' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Chocolate Baton' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Milk Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Dark Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'ba1e1aa8-0be6-4a3a-83b9-45780b13b710'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='White Chocolate' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'a0babb4d-0f3a-4f84-8c7a-6b8a2bbbedd0'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Lemon Puree' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, 'a0babb4d-0f3a-4f84-8c7a-6b8a2bbbedd0'::uuid, false FROM ingredient WHERE organisation_id=2 AND ingredient_name='Chocolate Baton' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Full Cream Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Skim Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Oat Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Soy Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Almond Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Tasty Shredded Cheese' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Organic Orange Juice' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Organic Apple Juice' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Thickened Cream' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, false FROM ingredient WHERE organisation_id=2 AND ingredient_name='Bacon' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Ham' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Lactose-Free Milk' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
INSERT INTO ingredient_supplier (ingredient_id, supplier_id, preferred_ind) SELECT ingredient_id, '97c8d90e-bb77-430c-aae8-ee95167549ca'::uuid, true FROM ingredient WHERE organisation_id=2 AND ingredient_name='Spring Water' ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;

COMMIT;
