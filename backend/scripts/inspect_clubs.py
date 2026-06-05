import sys

sys.path.append("/Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend")

from core.database import get_sb
from core.tables import CLUBS

sb = get_sb()
r = sb.table(CLUBS).select("id, club_name, created_by").execute()
print("Clubs in DB:")
for club in r.data or []:
    print(f"ID: {club['id']}, Name: {club['club_name']}, Created By: {club['created_by']}")
