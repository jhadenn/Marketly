# Marketly
Marketly is a modular marketplace tracking platform that aggregates and normalizes listings from multiple online marketplaces into a single, unified system. It enables price monitoring, listing discovery, and data analysis across platforms, starting with Kijiji and designed to scale to additional marketplaces.

## How to run

0. ensure your running the backend

* cd backend

1. create virtual environment 

* python -m venv .venv
* .venv\Scripts\activate


2. install dependencies

* pip install -e ".[dev]"

3. run the API

* uvicorn app.main:app --reload