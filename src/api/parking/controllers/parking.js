'use strict';

/**
 * parking controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::parking.parking', ({ strapi }) => ({
  ...createCoreController('api::parking.parking'),

  async park(ctx){
    const { parkingId, car } = ctx.request.body;

    try {

      console.info("Get user from car license plate");

      const userInformation = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {car: car},
        populate: {
          current_session: true
        }
      });

      console.info("Check if the user isn't parked yet (doesn't have a current session)");

      if (userInformation.current_session){
        return ctx.badRequest('Car is already parked');
      }

      console.info("Check if parking has available spots");

      const parking = await strapi.entityService.findOne('api::parking.parking', parkingId, {
        populate: {
          capacity: true
        }
      })

      if (!parking || BigInt(parking.capacity.available) <= 0){
        return ctx.badRequest('Parking is not available or does not exist');
      }

      console.info("Creating a new duration")

      const duration = await strapi.entityService.create('api::duration.duration', {
        data: {
          start: new Date(),
          end: null,
          publishedAt: new Date(),
        }
      })

      console.info("Creating a new parking session")

      const session = await strapi.entityService.create('api::current-session.current-session', {
        data: {
          car: car,
          parking: parkingId,
          duration: duration.id,
          user: userInformation.id,
          publishedAt: new Date(),
        }
      })

      console.info("Updating parking capacity")

      await strapi.entityService.update('api::capacity.capacity', parking.capacity.id, {
        data: {
          available: Number(parking.capacity.available) - 1,
          taken: Number(parking.capacity.taken) + 1,
          updatedAt: new Date(),
        }
      })

      return {message: "Parking session started successfully", session};

    } catch (error) {
      return ctx.internalServerError(error);
    }
  },

  async leave(ctx){
    const { paymentMethod, car } = ctx.request.body;

    try {

      console.info("Get user information");

      const userInformation = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: {car: car},
        populate: {
          current_session: true
        }
      });

      const currentSessionId = userInformation.current_session.id;

      console.info("Get current session");

      const currentSession = await strapi.entityService.findOne('api::current-session.current-session', currentSessionId, {
        populate: {
          duration: true,
          parking: {
            populate: {
              price_rates: true,
              location: true,
              currency: true,
              capacity: true,
            }
          },
        }
      })
      console.info("Update duration of session");
      const duration = await strapi.entityService.update('api::duration.duration', currentSession.duration.id, {
        data: {
          end: new Date(),
          updatedAt: new Date(),
        }
      })
      console.info("Update availability of parking");
      await strapi.entityService.update('api::capacity.capacity', currentSession.parking.capacity.id, {
        data: {
          available: Number(currentSession.parking.capacity.available) + 1,
          taken: Number(currentSession.parking.capacity.taken) - 1,
          updatedAt: new Date(),
        }
      });
      console.info("Deleting current session");
      await strapi.entityService.delete('api::current-session.current-session', currentSessionId);

      const calculateParkingPrice = (durationInMinutes, priceRate) => {
        priceRate.sort((a, b) => a.minutes - b.minutes);

        let calculatedPrice = priceRate[priceRate.length - 1].price;

        for (let entry of priceRate) {
            if (durationInMinutes <= entry.minutes) {
                calculatedPrice = entry.price;
                break;
            }
        }

        if (!calculatedPrice){
          return 0;
        }

        return calculatedPrice;
    };

      function calculateMinutes(startTime, endTime){
        const start = new Date(startTime);
        const end = new Date(endTime);

        const differenceInMilliseconds = end.getTime() - start.getTime();
        const differenceInMinutes = differenceInMilliseconds / (1000 * 60);

        return differenceInMinutes;
      }
      console.log("Create payment with price calculations");
      const payment = await strapi.entityService.create('api::payment.payment', {
        data: {
          amount: calculateParkingPrice(calculateMinutes(duration.start, duration.end),currentSession.parking.price_rates),
          method: paymentMethod,
          currency: currentSession.parking.currency.id,
          time: new Date(),
          publishedAt: new Date(),
        }
      });
      console.log("Create recent transaction");
      const recentTransaction = await strapi.entityService.create('api::recent-transaction.recent-transaction', {
        data: {
          car: currentSession.car,
          duration: currentSession.duration.id,
          parking: currentSession.parking.id,
          payment: payment.id,
          user: userInformation.id,
          publishedAt: new Date(),
        }
      });

      return {message: "Parking session left successfully", recentTransaction};

    } catch (error) {
      return ctx.internalServerError(error);
    }
  }

}));
