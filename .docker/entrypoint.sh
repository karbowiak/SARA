#!/bin/sh
set -e

# Default values
TYPE="${TYPE:-discord}"
CONFIGPATH="${CONFIGPATH:-config/config.ts}"

# Validate config file exists
if [ ! -f "$CONFIGPATH" ]; then
    echo "ERROR: Config file not found at '$CONFIGPATH'"
    echo ""
    echo "Please mount your config file, for example:"
    echo "  docker run -v /path/to/config.ts:/app/config/config.ts sara-bot"
    echo ""
    echo "Or set CONFIGPATH environment variable to the correct path."
    exit 1
fi

echo "Starting bot with TYPE=$TYPE using config at $CONFIGPATH"

# Run the bot with the specified type
exec bun cli.ts "$TYPE" --config "$CONFIGPATH"
