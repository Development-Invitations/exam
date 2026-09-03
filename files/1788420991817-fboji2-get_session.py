from telethon.sync import TelegramClient
from telethon.sessions import StringSession

API_ID = 39381676
API_HASH = "f4839707716b8274cffdfb9aa01960f6"

print("=" * 50)
print("Получаем session string")
print("=" * 50)

with TelegramClient(StringSession(), API_ID, API_HASH) as client:
    session_string = client.session.save()
    print()
    print("=" * 50)
    print("✅ Твой SESSION_STRING:")
    print("=" * 50)
    print()
    print(session_string)
    print()
    print("=" * 50)
    print("Скопируй строку выше и добавь в GitHub секрет SESSION_STRING")
    print("=" * 50)
