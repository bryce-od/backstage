/*
 * Copyright 2020 The Backstage Authors
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

const mockAccess = jest.fn();
jest.doMock('fs-extra', () => ({
  access: mockAccess,
  promises: {
    access: mockAccess,
  },
  constants: {
    F_OK: 0,
    W_OK: 1,
  },
  mkdir: jest.fn(),
  remove: jest.fn(),
}));

import {
  getVoidLogger,
  PluginDatabaseManager,
  DatabaseManager,
  UrlReaders,
  DockerContainerRunner,
} from '@backstage/backend-common';
import { CatalogApi } from '@backstage/catalog-client';
import { ConfigReader } from '@backstage/config';
import express from 'express';
import request from 'supertest';
import { TemplateEntityV1beta2 } from '@backstage/catalog-model';
/**
 * TODO: The following should import directly from the router file.
 * Due to a circular dependency between this plugin and the
 * plugin-scaffolder-backend-module-cookiecutter plugin, it results in an error:
 * TypeError: _pluginscaffolderbackend.createTemplateAction is not a function
 */
import { createRouter } from '../index';

const createCatalogClient = (templates: any[] = []) =>
  ({
    getEntities: async () => ({ items: templates }),
  } as CatalogApi);

function createDatabase(): PluginDatabaseManager {
  return DatabaseManager.fromConfig(
    new ConfigReader({
      backend: {
        database: {
          client: 'sqlite3',
          connection: ':memory:',
        },
      },
    }),
  ).forPlugin('scaffolder');
}

const mockUrlReader = UrlReaders.default({
  logger: getVoidLogger(),
  config: new ConfigReader({}),
});

describe('createRouter', () => {
  let app: express.Express;
  const template: TemplateEntityV1beta2 = {
    apiVersion: 'backstage.io/v1beta2',
    kind: 'Template',
    metadata: {
      description: 'Create a new CRA website project',
      name: 'create-react-app-template',
      tags: ['experimental', 'react', 'cra'],
      title: 'Create React App Template',
      annotations: {
        'backstage.io/managed-by-location': 'url:https://dev.azure.com',
      },
    },
    spec: {
      owner: 'web@example.com',
      type: 'website',
      steps: [],
      parameters: {
        type: 'object',
        required: ['required'],
        properties: {
          required: {
            type: 'string',
            description: 'Required parameter',
          },
        },
      },
    },
  };

  beforeAll(async () => {
    const router = await createRouter({
      logger: getVoidLogger(),
      config: new ConfigReader({}),
      database: createDatabase(),
      catalogClient: createCatalogClient([template]),
      containerRunner: new DockerContainerRunner({} as any),
      reader: mockUrlReader,
    });
    app = express().use(router);
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /v2/actions', () => {
    it('lists available actions', async () => {
      const response = await request(app).get('/v2/actions').send();
      expect(response.status).toEqual(200);
      expect(response.body[0].id).toBeDefined();
      expect(response.body.length).toBeGreaterThan(8);
    });
  });

  describe('POST /v2/tasks', () => {
    it('rejects template values which do not match the template schema definition', async () => {
      const response = await request(app)
        .post('/v2/tasks')
        .send({
          templateName: 'create-react-app-template',
          values: {
            storePath: 'https://github.com/backstage/backstage',
          },
        });

      expect(response.status).toEqual(400);
    });

    it('return the template id', async () => {
      const response = await request(app)
        .post('/v2/tasks')
        .send({
          templateName: 'create-react-app-template',
          values: {
            required: 'required-value',
          },
        });

      expect(response.body.id).toBeDefined();
      expect(response.status).toEqual(201);
    });
  });

  describe('GET /v2/tasks/:taskId', () => {
    it('does not divulge secrets', async () => {
      const postResponse = await request(app)
        .post('/v2/tasks')
        .set('Authorization', 'Bearer secret')
        .send({
          templateName: 'create-react-app-template',
          values: {
            required: 'required-value',
          },
        });

      const response = await request(app)
        .get(`/v2/tasks/${postResponse.body.id}`)
        .send();
      expect(response.status).toEqual(200);
      expect(response.body.secrets).toBeUndefined();
    });
  });
});
