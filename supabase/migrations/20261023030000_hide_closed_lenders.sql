-- Suncorp, HSBC and RAMS no longer accept new home loan applications; hide them from the board.
-- Their rows and history are kept; set active back to true to show a lender again.
update public.lenders set active = false where id in ('suncorp', 'hsbc', 'rams');
