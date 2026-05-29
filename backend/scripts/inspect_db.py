import sys

sys.path.append("/Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend")

from core.database import get_sb
from core.tables import EVENT_DATES, EVENTS, USERS

sb = get_sb()

# Query distinct schools from events table
try:
    res_events = sb.table(EVENTS).select("school").execute()
    distinct_schools_events = set(row["school"] for row in res_events.data if row.get("school"))
    print("Distinct schools in events:")
    for s in sorted(distinct_schools_events):
        print(f" - {s}")
except Exception as e:
    print(f"Failed to query EVENTS: {e}")

try:
    res_dates = sb.table(EVENT_DATES).select("event_id,dtstart_utc").limit(5).execute()
    print("Query EVENT_DATES success:", len(res_dates.data))
except Exception as e:
    print(f"Failed to query EVENT_DATES: {e}")

try:
    q = (
        sb.table(EVENT_DATES)
        .select("event_id,dtstart_utc,dtend_utc,tz,events!inner(id,title)")
        .limit(5)
        .execute()
    )
    print("Joined query success:", len(q.data))
except Exception as e:
    print(f"Failed to run joined query: {e}")

# Query distinct schools from users table
try:
    res_users = sb.table(USERS).select("school").execute()
    distinct_schools_users = set(row["school"] for row in res_users.data if row.get("school"))
    print("Distinct schools in users:")
    for s in sorted(distinct_schools_users):
        print(f" - {s}")
except Exception as e:
    print(f"Failed to query USERS: {e}")
