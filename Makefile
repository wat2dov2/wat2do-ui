.PHONY: dev seed stop db-reset
dev seed stop db-reset:
	python3 scripts/dev.py $@
