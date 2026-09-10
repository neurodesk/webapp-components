#!/bin/sh
set -eu
profile=${1:?usage: store_notary_credentials.sh PROFILE APPLE_ID TEAM_ID}
apple_id=${2:?usage: store_notary_credentials.sh PROFILE APPLE_ID TEAM_ID}
team_id=${3:?usage: store_notary_credentials.sh PROFILE APPLE_ID TEAM_ID}
echo "Enter the app-specific password at Apple's secure prompt; it is stored in Keychain only."
xcrun notarytool store-credentials "$profile" --apple-id "$apple_id" --team-id "$team_id"
