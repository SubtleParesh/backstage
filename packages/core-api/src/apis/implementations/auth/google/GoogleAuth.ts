/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import GoogleIcon from '@material-ui/icons/AcUnit';
import { DefaultAuthConnector } from '../../../../lib/AuthConnector';
import { GoogleSession } from './types';
import {
  OAuthApi,
  OpenIdConnectApi,
  ProfileInfoApi,
  ProfileInfo,
  SessionStateApi,
  SessionState,
  BackstageIdentityApi,
  AuthRequestOptions,
  BackstageIdentity,
} from '../../../definitions/auth';
import { OAuthRequestApi, AuthProvider } from '../../../definitions';
import { SessionManager } from '../../../../lib/AuthSessionManager/types';
import { RefreshingAuthSessionManager } from '../../../../lib/AuthSessionManager';
import { Observable } from '../../../../types';

type CreateOptions = {
  // TODO(Rugvip): These two should be grabbed from global config when available, they're not unique to GoogleAuth
  apiOrigin: string;
  basePath: string;

  oauthRequestApi: OAuthRequestApi;

  environment?: string;
  provider?: AuthProvider & { id: string };
};

export type GoogleAuthResponse = {
  providerInfo: {
    accessToken: string;
    idToken: string;
    scope: string;
    expiresInSeconds: number;
  };
  profile: ProfileInfo;
  backstageIdentity: BackstageIdentity;
};

const DEFAULT_PROVIDER = {
  id: 'google',
  title: 'Google',
  icon: GoogleIcon,
};

const SCOPE_PREFIX = 'https://www.googleapis.com/auth/';

class GoogleAuth
  implements
    OAuthApi,
    OpenIdConnectApi,
    ProfileInfoApi,
    BackstageIdentityApi,
    SessionStateApi {
  static create({
    apiOrigin,
    basePath,
    environment = 'development',
    provider = DEFAULT_PROVIDER,
    oauthRequestApi,
  }: CreateOptions) {
    const connector = new DefaultAuthConnector({
      apiOrigin,
      basePath,
      environment,
      provider,
      oauthRequestApi: oauthRequestApi,
      sessionTransform(res: GoogleAuthResponse): GoogleSession {
        return {
          ...res,
          providerInfo: {
            idToken: res.providerInfo.idToken,
            accessToken: res.providerInfo.accessToken,
            scopes: GoogleAuth.normalizeScopes(res.providerInfo.scope),
            expiresAt: new Date(
              Date.now() + res.providerInfo.expiresInSeconds * 1000,
            ),
          },
        };
      },
    });

    const sessionManager = new RefreshingAuthSessionManager({
      connector,
      defaultScopes: new Set([
        'openid',
        `${SCOPE_PREFIX}userinfo.email`,
        `${SCOPE_PREFIX}userinfo.profile`,
      ]),
      sessionScopes: (session: GoogleSession) => session.providerInfo.scopes,
      sessionShouldRefresh: (session: GoogleSession) => {
        const expiresInSec =
          (session.providerInfo.expiresAt.getTime() - Date.now()) / 1000;
        return expiresInSec < 60 * 5;
      },
    });

    return new GoogleAuth(sessionManager);
  }

  sessionState$(): Observable<SessionState> {
    return this.sessionManager.sessionState$();
  }

  constructor(private readonly sessionManager: SessionManager<GoogleSession>) {}

  async getAccessToken(
    scope?: string | string[],
    options?: AuthRequestOptions,
  ) {
    const session = await this.sessionManager.getSession({
      ...options,
      scopes: GoogleAuth.normalizeScopes(scope),
    });
    return session?.providerInfo.accessToken ?? '';
  }

  async getIdToken(options: AuthRequestOptions = {}) {
    const session = await this.sessionManager.getSession(options);
    return session?.providerInfo.idToken ?? '';
  }

  async logout() {
    await this.sessionManager.removeSession();
  }

  async getBackstageIdentity(
    options: AuthRequestOptions = {},
  ): Promise<BackstageIdentity | undefined> {
    const session = await this.sessionManager.getSession(options);
    return session?.backstageIdentity;
  }

  async getProfile(options: AuthRequestOptions = {}) {
    const session = await this.sessionManager.getSession(options);
    return session?.profile;
  }

  static normalizeScopes(scopes?: string | string[]): Set<string> {
    if (!scopes) {
      return new Set();
    }

    const scopeList = Array.isArray(scopes)
      ? scopes
      : scopes.split(/[\s]/).filter(Boolean);

    const normalizedScopes = scopeList.map(scope => {
      if (scope === 'openid') {
        return scope;
      }

      if (scope === 'profile' || scope === 'email') {
        return `${SCOPE_PREFIX}userinfo.${scope}`;
      }

      if (scope.startsWith(SCOPE_PREFIX)) {
        return scope;
      }

      return `${SCOPE_PREFIX}${scope}`;
    });

    return new Set(normalizedScopes);
  }
}
export default GoogleAuth;
