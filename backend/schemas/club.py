from pydantic import BaseModel
from typing import Literal


class ClubCreate(BaseModel):
    club_name: str
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str
    logo_url: str | None = None


class ClubUpdate(BaseModel):
    club_name: str | None = None
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str | None = None
    logo_url: str | None = None


class ClubResponse(BaseModel):
    id: int
    club_name: str
    categories: list[str] | None = None
    club_page: str | None = None
    ig: str | None = None
    discord: str | None = None
    club_type: str
    logo_url: str | None = None

    model_config = {"from_attributes": True}


class DiscordChannelOption(BaseModel):
    id: str
    name: str


class DiscordServerOption(BaseModel):
    id: str
    name: str
    channels: list[DiscordChannelOption]


class DiscordIntegrationOptionsResponse(BaseModel):
    oauth_url: str
    servers: list[DiscordServerOption]


class DiscordIntegrationUpdate(BaseModel):
    connected: bool = True
    server_id: str
    server_name: str
    channel_id: str
    channel_name: str


class DiscordIntegrationResponse(BaseModel):
    club_id: int
    connected: bool
    name: str | None = None
    server_id: str | None = None
    server_name: str | None = None
    channel_id: str | None = None
    channel_name: str | None = None
    last_sync: str | None = None


IntegrationPlatform = Literal[
    "whatsapp",
    "discord",
    "instagram",
    "slack",
    "telegram",
    "linkedin",
    "facebook",
]


class ClubIntegrationUpdate(BaseModel):
    connected: bool = True
    name: str | None = None
    metadata: dict[str, str] | None = None


class ClubIntegrationResponse(BaseModel):
    club_id: int
    platform: IntegrationPlatform
    connected: bool
    name: str | None = None
    last_sync: str | None = None
    metadata: dict[str, str] | None = None
