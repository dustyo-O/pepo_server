'use strict';

var mongoose = require('../libs/mongoose-connect');
var when = require('when');
var Schema = mongoose.Schema;

var schema = new Schema({
    author: {type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true},

    content: {
        type: String
    },
    timestamp: {type: Date, default: Date.now},
    extras: {
        parentTweetId: {
            type: Schema.Types.ObjectId,
            ref: 'Tweet'
        },
        retweets: [{type: Schema.Types.ObjectId, ref: 'User'}],
        commentedTweetId: {
            type: Schema.Types.ObjectId,
            ref: 'Tweet'
        },
        comments: [{type: Schema.Types.ObjectId, ref: 'Tweet'}],
        likes: [{type: Schema.Types.ObjectId, ref: 'User'}],
        image: {type: String},
        attachment: {type: Schema.Types.Mixed},
        url: {type: String},
        geo: {type: Schema.Types.Mixed}
    }
});
schema.statics.userTweetsCombined = function (user) {
    var all = this.find({author: user._id}).sort({timestamp: -1}).limit(10).exec();
    var images = this.find({
        author: user._id,
        'extras.image': {$exists: true, $ne: ''}
    }).sort({timestamp: -1}).limit(10).exec();
    var liked = this.find({'extras.likes': user._id}).sort({timestamp: -1}).limit(10).exec();
    return when.all([all, images, liked]);
};
exports.Tweet = mongoose.model('Tweet', schema);
exports.Mongoose = mongoose;
