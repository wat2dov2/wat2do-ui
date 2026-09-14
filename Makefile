.PHONY: dev seed stop reset
dev seed stop reset:
	python3 scripts/dev.py $@
