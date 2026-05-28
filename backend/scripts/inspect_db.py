import os
import sys

sys.path.append("/Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend")

from core.database import get_sb
from core.tables import EVENTS, USERS

sb = get_sb()

# Query distinct schools from events table
res_events = sb.table(EVENTS).select("school").execute()
distinct_schools_events = set(row["school"] for row in res_events.data if row.get("school"))
print("Distinct schools in events:")
for s in sorted(distinct_schools_events):
    print(f" - {s}")

# Query distinct schools from users table
res_users = sb.table(USERS).select("school").execute()
distinct_schools_users = set(row["school"] for row in res_users.data if row.get("school"))
print("Distinct schools in users:")
for s in sorted(distinct_schools_users):
    print(f" - {s}")
